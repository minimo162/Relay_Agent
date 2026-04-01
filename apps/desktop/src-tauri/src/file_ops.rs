use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use encoding_rs::SHIFT_JIS;
use lopdf::Document;
use regex::Regex;
use serde_json::{json, Value};
use zip::ZipArchive;

pub fn execute_file_list(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "file.list")?;
    let directory = resolve_safe_path(&path)?;
    let recursive = args
        .get("recursive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let pattern = args.get("pattern").and_then(Value::as_str).map(str::trim);

    if !directory.is_dir() {
        return Err(format!(
            "`{}` is not a readable directory",
            directory.display()
        ));
    }

    let mut entries = Vec::new();
    collect_file_entries(&directory, recursive, pattern, &mut entries)?;

    Ok(json!({
        "path": directory,
        "recursive": recursive,
        "entries": entries,
    }))
}

pub fn execute_file_read_text(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "file.read_text")?;
    let file_path = resolve_safe_path(&path)?;
    let max_bytes = args
        .get("maxBytes")
        .and_then(Value::as_u64)
        .unwrap_or(65_536) as usize;
    let metadata = fs::metadata(&file_path).map_err(|error| {
        format!(
            "failed to read file metadata for `{}`: {error}",
            file_path.display()
        )
    })?;

    if !metadata.is_file() {
        return Err(format!(
            "`{}` is not a readable text file",
            file_path.display()
        ));
    }

    if metadata.len() > 1_048_576 {
        return Err(format!(
            "`{}` is larger than the 1MB read limit",
            file_path.display()
        ));
    }

    let bytes = fs::read(&file_path)
        .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
    let (content, encoding) = decode_text_file(&bytes)?;
    let truncated_content = truncate_to_byte_limit(&content, max_bytes);
    let truncated = truncated_content.len() < content.len();

    Ok(json!({
        "path": file_path,
        "encoding": encoding,
        "truncated": truncated,
        "content": truncated_content,
    }))
}

pub fn execute_file_stat(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "file.stat")?;
    let file_path = resolve_safe_path(&path)?;
    let metadata = fs::metadata(&file_path).map_err(|error| {
        format!(
            "failed to read file metadata for `{}`: {error}",
            file_path.display()
        )
    })?;

    Ok(json!({
        "path": file_path,
        "exists": true,
        "isDirectory": metadata.is_dir(),
        "isFile": metadata.is_file(),
        "sizeBytes": metadata.len(),
        "modifiedAt": metadata.modified().ok().map(format_system_time),
    }))
}

pub fn execute_file_copy(args: &Value) -> Result<Value, String> {
    let source = required_value_string(args, "sourcePath", "file.copy")?;
    let dest = required_value_string(args, "destPath", "file.copy")?;
    let overwrite = args
        .get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let source_path = resolve_safe_path(&source)?;
    let dest_path = resolve_safe_path(&dest)?;

    if !source_path.is_file() {
        return Err(format!("source file not found: {}", source_path.display()));
    }

    if dest_path.exists() {
        if !overwrite {
            return Err(format!(
                "destination already exists: {}",
                dest_path.display()
            ));
        }
        remove_existing_path(&dest_path)?;
    }

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create destination directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let bytes_copied = fs::copy(&source_path, &dest_path).map_err(|error| {
        format!(
            "failed to copy `{}` to `{}`: {error}",
            source_path.display(),
            dest_path.display()
        )
    })?;

    Ok(json!({
        "ok": true,
        "sourcePath": source_path,
        "destPath": dest_path,
        "bytesCopied": bytes_copied,
    }))
}

pub fn execute_file_move(args: &Value) -> Result<Value, String> {
    let source = required_value_string(args, "sourcePath", "file.move")?;
    let dest = required_value_string(args, "destPath", "file.move")?;
    let overwrite = args
        .get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let source_path = resolve_safe_path(&source)?;
    let dest_path = resolve_safe_path(&dest)?;

    if !source_path.exists() {
        return Err(format!("source path not found: {}", source_path.display()));
    }

    if dest_path.exists() {
        if !overwrite {
            return Err(format!(
                "destination already exists: {}",
                dest_path.display()
            ));
        }
        remove_existing_path(&dest_path)?;
    }

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create destination directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    fs::rename(&source_path, &dest_path).or_else(|rename_error| {
        fs::copy(&source_path, &dest_path)
            .map_err(|copy_error| {
                format!(
                    "failed to move `{}` to `{}`: {rename_error}; fallback copy failed: {copy_error}",
                    source_path.display(),
                    dest_path.display()
                )
            })
            .and_then(|_| remove_existing_path(&source_path))
    })?;

    Ok(json!({
        "ok": true,
        "sourcePath": source_path,
        "destPath": dest_path,
    }))
}

pub fn execute_file_delete(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "file.delete")?;
    let file_path = resolve_safe_path(&path)?;
    let to_recycle_bin = args
        .get("toRecycleBin")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    if !file_path.exists() {
        return Err(format!("file not found: {}", file_path.display()));
    }

    if to_recycle_bin {
        trash::delete(&file_path).map_err(|error| {
            format!("failed to move `{}` to trash: {error}", file_path.display())
        })?;
    } else {
        remove_existing_path(&file_path)?;
    }

    Ok(json!({
        "ok": true,
        "path": file_path,
        "method": if to_recycle_bin { "recycle_bin" } else { "permanent" },
    }))
}

pub fn execute_text_search(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "text.search")?;
    let pattern = required_value_string(args, "pattern", "text.search")?;
    let max_matches = args.get("maxMatches").and_then(Value::as_u64).unwrap_or(50) as usize;
    let context_lines = args
        .get("contextLines")
        .and_then(Value::as_u64)
        .unwrap_or(2) as usize;
    let file_path = resolve_safe_path(&path)?;
    let bytes = fs::read(&file_path)
        .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
    let (content, encoding) = decode_text_file(&bytes)?;
    let regex = Regex::new(&pattern).map_err(|error| format!("invalid regex: {error}"))?;
    let lines = content.lines().collect::<Vec<_>>();
    let mut matches = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        if matches.len() >= max_matches {
            break;
        }
        if !regex.is_match(line) {
            continue;
        }

        let start = index.saturating_sub(context_lines);
        let end = (index + context_lines + 1).min(lines.len());
        let context = (start..end)
            .map(|line_index| {
                json!({
                    "lineNumber": line_index + 1,
                    "text": lines[line_index],
                    "isMatch": line_index == index,
                })
            })
            .collect::<Vec<_>>();

        matches.push(json!({
            "lineNumber": index + 1,
            "matchedText": line,
            "context": context,
        }));
    }

    Ok(json!({
        "ok": true,
        "path": file_path,
        "pattern": pattern,
        "encoding": encoding,
        "matchCount": matches.len(),
        "matches": matches,
        "truncated": matches.len() >= max_matches,
    }))
}

pub fn execute_text_replace(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "text.replace")?;
    let pattern = required_value_string(args, "pattern", "text.replace")?;
    let replacement = args
        .get("replacement")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let create_backup = args
        .get("createBackup")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let file_path = resolve_safe_path(&path)?;
    let bytes = fs::read(&file_path)
        .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
    let (content, encoding) = decode_text_file(&bytes)?;
    let regex = Regex::new(&pattern).map_err(|error| format!("invalid regex: {error}"))?;
    let change_count = regex.find_iter(&content).count();

    if change_count == 0 {
        return Ok(json!({
            "ok": true,
            "path": file_path,
            "pattern": pattern,
            "replacement": replacement,
            "changeCount": 0,
            "backupCreated": false,
            "message": "no matches found",
        }));
    }

    if create_backup {
        let backup_path = backup_path_for(&file_path)?;
        fs::copy(&file_path, &backup_path).map_err(|error| {
            format!(
                "failed to create backup `{}`: {error}",
                backup_path.display()
            )
        })?;
    }

    let next_content = regex
        .replace_all(&content, replacement.as_str())
        .into_owned();
    write_text_file(&file_path, &next_content, encoding)?;

    Ok(json!({
        "ok": true,
        "path": file_path,
        "pattern": pattern,
        "replacement": replacement,
        "changeCount": change_count,
        "backupCreated": create_backup,
    }))
}

pub fn preview_text_replace(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "text.replace")?;
    let pattern = required_value_string(args, "pattern", "text.replace")?;
    let file_path = resolve_safe_path(&path)?;
    let bytes = fs::read(&file_path)
        .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
    let (content, _) = decode_text_file(&bytes)?;
    let regex = Regex::new(&pattern).map_err(|error| format!("invalid regex: {error}"))?;

    Ok(json!({
        "path": file_path,
        "matchCount": regex.find_iter(&content).count(),
    }))
}

pub fn preview_text_replace_detail(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "text.replace")?;
    let pattern = required_value_string(args, "pattern", "text.replace")?;
    let replacement = args
        .get("replacement")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let file_path = resolve_safe_path(&path)?;
    let bytes = fs::read(&file_path)
        .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
    let (content, _) = decode_text_file(&bytes)?;
    let regex = Regex::new(&pattern).map_err(|error| format!("invalid regex: {error}"))?;
    let next_content = regex.replace_all(&content, replacement.as_str()).into_owned();
    let change_count = regex.find_iter(&content).count();

    Ok(json!({
        "path": file_path,
        "matchCount": change_count,
        "before": truncate_preview_text(&content),
        "after": truncate_preview_text(&next_content),
        "truncated": content.chars().count() > 4_000 || next_content.chars().count() > 4_000,
    }))
}

pub fn execute_document_read_text(args: &Value) -> Result<Value, String> {
    let path = required_value_string(args, "path", "document.read_text")?;
    let max_chars = args
        .get("maxChars")
        .and_then(Value::as_u64)
        .unwrap_or(50_000) as usize;
    let file_path = resolve_safe_path(&path)?;

    if !file_path.is_file() {
        return Err(format!("file not found: {}", file_path.display()));
    }

    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let text = match extension.as_str() {
        "docx" => extract_docx_text(&file_path)?,
        "pptx" => extract_pptx_text(&file_path)?,
        "pdf" => extract_pdf_text(&file_path)?,
        "txt" | "md" | "csv" | "json" | "xml" | "yaml" | "yml" | "toml" => {
            let bytes = fs::read(&file_path)
                .map_err(|error| format!("failed to read `{}`: {error}", file_path.display()))?;
            decode_text_file(&bytes)?.0
        }
        _ => {
            return Err(format!(
                "unsupported file type: .{}",
                file_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
            ))
        }
    };

    let truncated_text = truncate_to_char_limit(&text, max_chars);
    let truncated = truncated_text.len() < text.len();

    Ok(json!({
        "ok": true,
        "path": file_path,
        "format": extension,
        "charCount": truncated_text.chars().count(),
        "truncated": truncated,
        "text": truncated_text,
    }))
}

fn required_value_string(args: &Value, key: &str, tool: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{tool} requires a non-empty `{key}` argument"))
}

fn resolve_safe_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path.trim());

    if !candidate.is_absolute() {
        return Err("file tools require an absolute path".to_string());
    }

    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("path traversal is blocked for file tools".to_string());
    }

    Ok(candidate)
}

fn collect_file_entries(
    directory: &Path,
    recursive: bool,
    pattern: Option<&str>,
    entries: &mut Vec<Value>,
) -> Result<(), String> {
    let read_dir = fs::read_dir(directory).map_err(|error| {
        format!(
            "failed to read directory `{}`: {error}",
            directory.display()
        )
    })?;

    for entry in read_dir {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect a directory entry under `{}`: {error}",
                directory.display()
            )
        })?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|error| {
            format!("failed to read metadata for `{}`: {error}", path.display())
        })?;
        let file_name = entry.file_name().to_string_lossy().into_owned();

        if pattern
            .map(|value| matches_file_pattern(&file_name, value))
            .unwrap_or(true)
        {
            entries.push(json!({
                "name": file_name,
                "path": path,
                "isDirectory": metadata.is_dir(),
                "isFile": metadata.is_file(),
                "sizeBytes": metadata.len(),
                "extension": path.extension().and_then(|value| value.to_str()),
                "modifiedAt": metadata.modified().ok().map(format_system_time),
            }));
        }

        if recursive && metadata.is_dir() {
            collect_file_entries(&path, true, pattern, entries)?;
        }
    }

    Ok(())
}

fn matches_file_pattern(file_name: &str, pattern: &str) -> bool {
    let trimmed = pattern.trim();
    if trimmed.is_empty() || trimmed == "*" {
        return true;
    }

    if let Some(suffix) = trimmed.strip_prefix("*.") {
        return file_name
            .rsplit_once('.')
            .map(|(_, extension)| extension.eq_ignore_ascii_case(suffix))
            .unwrap_or(false);
    }

    file_name.contains(trimmed)
}

fn remove_existing_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("failed to remove directory `{}`: {error}", path.display()))
    } else {
        fs::remove_file(path)
            .map_err(|error| format!("failed to remove file `{}`: {error}", path.display()))
    }
}

fn backup_path_for(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("failed to create backup path for `{}`", path.display()))?;

    Ok(path.with_file_name(format!("{file_name}.bak")))
}

fn truncate_preview_text(value: &str) -> String {
    const MAX_CHARS: usize = 4_000;
    let char_count = value.chars().count();
    if char_count <= MAX_CHARS {
        return value.to_string();
    }

    let truncated = value.chars().take(MAX_CHARS).collect::<String>();
    format!("{truncated}\n\n...[truncated]")
}

fn decode_text_file(bytes: &[u8]) -> Result<(String, &'static str), String> {
    if let Ok(content) = String::from_utf8(bytes.to_vec()) {
        return Ok((content, "utf-8"));
    }

    let (decoded, _, had_errors) = SHIFT_JIS.decode(bytes);
    if had_errors {
        return Err("file.read_text only supports UTF-8 or Shift_JIS text".to_string());
    }

    Ok((decoded.into_owned(), "shift_jis"))
}

fn write_text_file(path: &Path, content: &str, encoding: &str) -> Result<(), String> {
    match encoding {
        "utf-8" => fs::write(path, content.as_bytes())
            .map_err(|error| format!("failed to write `{}`: {error}", path.display())),
        "shift_jis" => {
            let (encoded, _, had_errors) = SHIFT_JIS.encode(content);
            if had_errors {
                return Err(format!(
                    "replacement text could not be encoded as Shift_JIS for `{}`",
                    path.display()
                ));
            }

            fs::write(path, encoded.as_ref())
                .map_err(|error| format!("failed to write `{}`: {error}", path.display()))
        }
        _ => Err(format!("unsupported text encoding `{encoding}`")),
    }
}

fn truncate_to_byte_limit(content: &str, max_bytes: usize) -> String {
    if content.len() <= max_bytes {
        return content.to_string();
    }

    let mut end = 0;
    for (index, _) in content.char_indices() {
        if index > max_bytes {
            break;
        }
        end = index;
    }

    if end == 0 {
        return String::new();
    }

    content[..end].to_string()
}

fn truncate_to_char_limit(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        return content.to_string();
    }

    content.chars().take(max_chars).collect()
}

fn format_system_time(value: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(value)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn extract_docx_text(path: &Path) -> Result<String, String> {
    extract_text_from_zip_entry(path, &["word/document.xml"])
}

fn extract_pptx_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("failed to open `{}`: {error}", path.display()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("failed to read pptx zip: {error}"))?;
    let mut slide_names = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|entry| entry.name().to_string())
        })
        .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        .collect::<Vec<_>>();
    slide_names.sort();

    let mut fragments = Vec::new();
    for name in slide_names {
        let mut entry = archive
            .by_name(&name)
            .map_err(|error| format!("failed to read `{name}` from pptx: {error}"))?;
        let mut xml = String::new();
        entry
            .read_to_string(&mut xml)
            .map_err(|error| format!("failed to decode `{name}`: {error}"))?;
        let text = strip_xml_to_text(&xml);
        if !text.trim().is_empty() {
            fragments.push(text);
        }
    }

    Ok(fragments.join("\n\n"))
}

fn extract_text_from_zip_entry(path: &Path, entry_names: &[&str]) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("failed to open `{}`: {error}", path.display()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("failed to read zip archive: {error}"))?;
    let mut fragments = Vec::new();

    for entry_name in entry_names {
        let mut entry = archive
            .by_name(entry_name)
            .map_err(|error| format!("failed to read `{entry_name}`: {error}"))?;
        let mut xml = String::new();
        entry
            .read_to_string(&mut xml)
            .map_err(|error| format!("failed to decode `{entry_name}`: {error}"))?;
        let text = strip_xml_to_text(&xml);
        if !text.trim().is_empty() {
            fragments.push(text);
        }
    }

    Ok(fragments.join("\n\n"))
}

fn strip_xml_to_text(xml: &str) -> String {
    let with_breaks = xml
        .replace("</w:p>", "\n")
        .replace("</a:p>", "\n")
        .replace("</text:p>", "\n")
        .replace("</w:tr>", "\n")
        .replace("</a:br/>", "\n")
        .replace("<w:tab/>", "\t")
        .replace("<a:tab/>", "\t");
    let tag_regex = Regex::new(r"<[^>]+>").expect("xml tag regex should compile");
    let whitespace_regex = Regex::new(r"\n{3,}").expect("whitespace regex should compile");
    let stripped = tag_regex.replace_all(&with_breaks, " ");

    whitespace_regex
        .replace_all(stripped.trim(), "\n\n")
        .into_owned()
}

fn extract_pdf_text(path: &Path) -> Result<String, String> {
    let document = Document::load(path)
        .map_err(|error| format!("failed to load pdf `{}`: {error}", path.display()))?;
    let page_numbers = document.get_pages().keys().copied().collect::<Vec<_>>();

    document.extract_text(&page_numbers).map_err(|error| {
        format!(
            "failed to extract pdf text from `{}`: {error}",
            path.display()
        )
    })
}
