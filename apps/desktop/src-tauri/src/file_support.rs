use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use encoding_rs::SHIFT_JIS;
use regex::Regex;
use serde_json::{json, Value};

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
    let next_content = regex
        .replace_all(&content, replacement.as_str())
        .into_owned();
    let change_count = regex.find_iter(&content).count();

    Ok(json!({
        "path": file_path,
        "matchCount": change_count,
        "before": truncate_preview_text(&content),
        "after": truncate_preview_text(&next_content),
        "truncated": content.chars().count() > 4_000 || next_content.chars().count() > 4_000,
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
